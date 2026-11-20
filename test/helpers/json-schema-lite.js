// A small JSON Schema checker for tests: the subset the public export schema
// uses (type, const, enum, required, properties, additionalProperties, items,
// minimum, local $ref). Enough to keep a builder and its schema in step
// without a validator dependency. Returns a list of problems, empty when valid.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const matchesType = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number');

export function validate(schema, value, root = schema, at = '$') {
	const errors = [];
	if (schema.$ref) {
		const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], root);
		if (!target) return [`${at}: unresolved ${schema.$ref}`];
		return validate(target, value, root, at);
	}
	if (schema.type) {
		const types = [].concat(schema.type);
		if (!types.some(t => matchesType(value, t))) return [`${at}: expected ${types.join('|')}, got ${typeOf(value)}`];
	}
	if ('const' in schema && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
	if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
	if (schema.minimum != null && typeof value === 'number' && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		for (const k of schema.required || []) if (!(k in value)) errors.push(`${at}: missing ${k}`);
		for (const [k, v] of Object.entries(value)) {
			if (schema.properties?.[k]) errors.push(...validate(schema.properties[k], v, root, `${at}.${k}`));
			else if (schema.additionalProperties === false) errors.push(`${at}: unexpected ${k}`);
			else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, v, root, `${at}.${k}`));
		}
	}
	if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, root, `${at}[${i}]`)));
	return errors;
}
