/**
 * The gate every parameter set passes before a value is bound to a query.
 *
 * AD-5 puts validation "at the API layer rather than requested by prompt", and
 * this is that layer on the Node side. Story 3.4 will additionally declare these
 * schemas to the model as `strict` tool definitions — but a model honouring a
 * schema is a cooperative property, and the caller this ultimately guards
 * against is one that has been talked into not cooperating. So nothing here
 * assumes the values arrived from a well-behaved source.
 *
 * **It throws rather than returning a result.** A caller that ignores a returned
 * validity flag executes the query anyway, and there is no compiler anywhere
 * that would object. A throw makes ignoring it the harder thing to do.
 *
 * **Own properties only, everywhere.** `Object.hasOwn` rather than `in` or a
 * plain read: `in` walks the prototype chain, so an object inheriting
 * `assessmentYear` would satisfy a `required` check while supplying nothing —
 * and a payload carrying a `__proto__` key is exactly what produces one.
 * `catalog/bind-values.ts` reads own properties for the same reason, and the two
 * have to agree or the gap between them is where an unchecked value gets bound.
 *
 * **An undeclared property is always rejected, and `additionalProperties` is
 * never consulted to decide it.** That is not an oversight. The architecture's
 * Consistency Conventions say "Every agent-facing tool declares `strict: true`
 * and `additionalProperties: false`. A tool without both is not registered", and
 * `ParameterSchema` types the field as the literal `false` so an open schema does
 * not compile. Branching on a field that cannot hold another value would add a
 * path no test could reach and imply an openness the catalog does not have.
 */

import type { ParameterSchema } from './entry'

export class ParameterValidationError extends Error {
  /**
   * The parameter at fault, or `''` when the whole argument was the problem.
   *
   * Carried separately from the message so a caller can act on it without
   * parsing prose — story 3.7 turns a rejection into a user-visible state.
   */
  readonly parameterName: string

  constructor(parameterName: string, message: string) {
    super(message)
    this.name = 'ParameterValidationError'
    this.parameterName = parameterName
  }
}

/**
 * Throws unless `values` is exactly what `schema` declares.
 *
 * Undeclared properties are rejected before missing ones, so a caller sending a
 * misspelled parameter is told about the spelling rather than about the
 * absence — the same mistake described two ways, and only one of them is
 * actionable.
 */
export function validateParameters(schema: ParameterSchema, values: unknown): void {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new ParameterValidationError(
      '',
      `a parameter set must be an object, and this was ${describe(values)}`,
    )
  }

  const supplied = values as Record<string, unknown>

  for (const name of Object.keys(supplied)) {
    if (!Object.hasOwn(schema.properties, name)) {
      throw new ParameterValidationError(
        name,
        `${name} is not declared by this catalog entry, which accepts ${declaredNames(schema)}`,
      )
    }
  }

  for (const name of schema.required) {
    if (!Object.hasOwn(supplied, name)) {
      throw new ParameterValidationError(name, `${name} is required and was not supplied`)
    }
  }

  for (const [name, declaration] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(supplied, name)) continue

    const value = supplied[name]

    if (declaration.type === 'string' && typeof value !== 'string') {
      throw new ParameterValidationError(
        name,
        `${name} must be a string, and this was ${describe(value)}`,
      )
    }

    // `Number.isInteger` is the whole check on purpose: it is false for NaN, for
    // both infinities and for every fraction, and true for nothing that is not a
    // number. A `typeof === 'number'` test paired with `% 1 === 0` accepts
    // Infinity, which reaches Postgres as an out-of-range integer.
    if (declaration.type === 'integer' && !Number.isInteger(value)) {
      throw new ParameterValidationError(
        name,
        `${name} must be an integer, and this was ${describe(value)}`,
      )
    }
  }
}

function declaredNames(schema: ParameterSchema): string {
  const names = Object.keys(schema.properties)

  return names.length === 0 ? 'no parameters' : names.join(', ')
}

/** Enough to identify what arrived, without putting a value into a message. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (Number.isNaN(value)) return 'NaN'

  return `a ${typeof value}`
}
