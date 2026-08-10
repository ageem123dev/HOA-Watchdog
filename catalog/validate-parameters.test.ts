/**
 * AD-5, at the point where a parameter set becomes trusted.
 *
 * "The agent selects a named entry from a fixed, version-controlled query
 * catalog and supplies typed parameters. Tool definitions are declared with
 * `strict: true` and `additionalProperties: false`, so parameter validation is
 * guaranteed at the API layer rather than requested by prompt."
 *
 * Story 3.4 is what hands these schemas to a model as tool definitions. This is
 * the half that does not depend on the model honouring anything: whatever
 * arrives, it is checked here before a single value is bound.
 *
 * **The values under test are attacker-shaped, not typo-shaped.** The caller
 * this eventually protects against is a prompt-injected agent, so the interesting
 * cases are an extra property nobody declared and a value that is the right type
 * by inheritance rather than by ownership — not a misspelled key.
 */

import { describe, expect, it } from 'vitest'

import type { ParameterSchema } from './entry'
import { ParameterValidationError, validateParameters } from './validate-parameters'

const SCHEMA: ParameterSchema = {
  type: 'object',
  properties: {
    unitNumber: { type: 'string', description: 'The unit as a treasurer would write it.' },
    assessmentYear: { type: 'integer', description: 'The year the assessment is for.' },
  },
  required: ['unitNumber', 'assessmentYear'],
  additionalProperties: false,
}

const WITH_AN_OPTIONAL: ParameterSchema = {
  type: 'object',
  properties: {
    unitNumber: { type: 'string', description: 'Required.' },
    note: { type: 'string', description: 'Optional.' },
  },
  required: ['unitNumber'],
  additionalProperties: false,
}

/** The error a call threw, or `undefined` if it returned. */
function thrownBy(call: () => void): unknown {
  try {
    call()
  } catch (error) {
    return error
  }

  return undefined
}

const NO_PARAMETERS: ParameterSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

describe('validateParameters', () => {
  describe('the values a catalog entry expects', () => {
    it('accepts a complete, correctly typed set', () => {
      expect(() =>
        validateParameters(SCHEMA, { unitNumber: '4B', assessmentYear: 2026 }),
      ).not.toThrow()
    })

    it('accepts an optional parameter being absent', () => {
      expect(() => validateParameters(WITH_AN_OPTIONAL, { unitNumber: '4B' })).not.toThrow()
    })

    it('accepts an optional parameter being present', () => {
      expect(() =>
        validateParameters(WITH_AN_OPTIONAL, { unitNumber: '4B', note: 'checked' }),
      ).not.toThrow()
    })

    it('accepts an empty set for an entry that declares no parameters', () => {
      expect(() => validateParameters(NO_PARAMETERS, {})).not.toThrow()
    })

    /**
     * Zero-length and zero-valued are ordinary values, not absences. A unit
     * number of `'0'` and a year of `0` must be distinguishable from a missing
     * parameter, or a falsy-check implementation would reject real input — which
     * is the single most common way a validator like this goes wrong.
     */
    it('accepts values that are falsy but present', () => {
      expect(() => validateParameters(SCHEMA, { unitNumber: '', assessmentYear: 0 })).not.toThrow()
    })
  })

  describe('a value set that does not match', () => {
    it('names the parameter that is missing', () => {
      expect(() => validateParameters(SCHEMA, { unitNumber: '4B' })).toThrow(
        /assessmentYear.*required/i,
      )
    })

    it('names the parameter nobody declared', () => {
      expect(() =>
        validateParameters(SCHEMA, { unitNumber: '4B', assessmentYear: 2026, limit: 1000 }),
      ).toThrow(/limit.*not declared/i)
    })

    it('names the parameter whose type is wrong', () => {
      expect(() =>
        validateParameters(SCHEMA, { unitNumber: '4B', assessmentYear: '2026' }),
      ).toThrow(/assessmentYear.*integer/i)
    })

    it('rejects a number where a string is declared', () => {
      expect(() => validateParameters(SCHEMA, { unitNumber: 4, assessmentYear: 2026 })).toThrow(
        /unitNumber.*string/i,
      )
    })

    it.each([
      ['a fraction', 2026.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects %s where an integer is declared', (_shape, value) => {
      expect(() => validateParameters(SCHEMA, { unitNumber: '4B', assessmentYear: value })).toThrow(
        /assessmentYear.*integer/i,
      )
    })

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('rejects %s as a declared value rather than reading it as absent', (_shape, value) => {
      // The message has to be the *type* one. `/assessmentYear/` alone also
      // matches "is required and was not supplied", so an implementation that
      // read an explicit null as an absence would satisfy a test whose name says
      // it does not. `Object.hasOwn` is true for a key set to undefined, which
      // is the distinction being asserted.
      expect(() => validateParameters(SCHEMA, { unitNumber: '4B', assessmentYear: value })).toThrow(
        /assessmentYear.*integer/i,
      )
    })

    /**
     * The error is captured outside the assertions rather than asserted inside a
     * `catch`. Inside one, a run where nothing is thrown falls through to the
     * `catch`-block assertions never executing — or, with `expect.unreachable`,
     * to that call's own AssertionError being caught and then reported as "not a
     * ParameterValidationError", which describes the wrong problem.
     */
    it('throws a named error carrying the parameter, not a bare Error', () => {
      const error = thrownBy(() => validateParameters(SCHEMA, { unitNumber: '4B' }))

      expect(error).toBeInstanceOf(ParameterValidationError)
      expect((error as ParameterValidationError).parameterName).toBe('assessmentYear')
    })
  })

  describe('a values argument that is not a parameter set at all', () => {
    it.each([
      ['null', null],
      ['an array', ['4B', 2026]],
      ['a string', '4B'],
      ['a number', 2026],
    ])('rejects %s', (_shape, values) => {
      expect(() => validateParameters(SCHEMA, values)).toThrow(ParameterValidationError)
    })
  })

  /**
   * `additionalProperties: false` has to mean *own* properties, and `required`
   * has to be satisfied by *own* properties.
   *
   * An implementation written with `in` or with a bare property read satisfies
   * every test above and still accepts an object whose `assessmentYear` comes
   * from its prototype — which is what a JSON payload carrying a `__proto__` key
   * produces once something has merged it into a plain object.
   */
  describe('properties that are not the object\'s own', () => {
    it('does not accept an inherited value as a supplied parameter', () => {
      const inherited = Object.create({ assessmentYear: 2026 }) as Record<string, unknown>
      inherited.unitNumber = '4B'

      expect(() => validateParameters(SCHEMA, inherited)).toThrow(/assessmentYear.*required/i)
    })

    it('rejects __proto__ as the undeclared property it is', () => {
      const payload = JSON.parse(
        '{"unitNumber":"4B","assessmentYear":2026,"__proto__":{"x":1}}',
      ) as Record<string, unknown>

      expect(() => validateParameters(SCHEMA, payload)).toThrow(/__proto__.*not declared/i)
    })
  })
})
