/**
 * defers a computation until first access, then caches its result.
 *
 * @param getter computes the value
 * @returns a holder whose `value` is computed on first read
 */
export const lazy = <T>(getter: () => T): { readonly value: T } => {
	return {
		get value() {
			const value = getter();
			Object.defineProperty(this, 'value', { value, enumerable: true });
			return value;
		},
	};
};
