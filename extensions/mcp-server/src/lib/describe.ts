import { errorMessage, truncate } from './text.ts';

const MAX_KEYS = 100;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING = 2000;
const FUNCTION_PREVIEW = 120;
const MAX_OUTPUT = 60_000;

const REACT_ELEMENT_TYPES = new Set([Symbol.for('react.element'), Symbol.for('react.transitional.element')]);

const functionPreview = (fn: Function) => {
	let src: string;
	try {
		src = Function.prototype.toString.call(fn);
	} catch {
		src = '';
	}
	return `[Function${fn.name ? ` ${fn.name}` : ''}: ${truncate(src.replace(/\s+/g, ' '), FUNCTION_PREVIEW)}]`;
};

/**
 * names a React component type.
 *
 * @param type an element's `type`: a tag name, component function, or memo/forwardRef wrapper
 * @returns the display name, with wrappers spelled out like `Memo(Foo)`
 */
export const componentName = (type: any): string => {
	if (typeof type === 'string') {
		return type;
	}
	if (typeof type === 'function') {
		return type.displayName || type.name || 'Anonymous';
	}
	if (type && typeof type === 'object') {
		if (type.displayName) {
			return type.displayName;
		}
		if (type.type) {
			return `Memo(${componentName(type.type)})`;
		}
		if (type.render) {
			return `ForwardRef(${componentName(type.render)})`;
		}
	}
	return String(type);
};

const nodePreview = (node: Node) => {
	if (!(node instanceof Element)) {
		return `[${node.nodeName}]`;
	}

	let s = node.tagName.toLowerCase();
	if (node.id) {
		s += `#${node.id}`;
	}
	if (node.classList.length) {
		s += `.${[...node.classList].join('.')}`;
	}
	return `<${s}>`;
};

const constructorName = (obj: object) => {
	try {
		const proto = Object.getPrototypeOf(obj);
		if (proto === null) {
			return 'Object(null)';
		}
		return proto.constructor?.name || 'Object';
	} catch {
		return 'Object';
	}
};

const safeGet = (obj: any, key: PropertyKey) => {
	try {
		return obj[key];
	} catch (e) {
		return `[Throws: ${errorMessage(e)}]`;
	}
};

const prototypeMethods = (obj: object) => {
	const methods = new Set<string>();
	let proto = Object.getPrototypeOf(obj);
	while (proto && proto !== Object.prototype) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			if (key === 'constructor') {
				continue;
			}

			const desc = Object.getOwnPropertyDescriptor(proto, key);
			if (desc && typeof desc.value === 'function') {
				methods.add(key);
			} else if (desc?.get) {
				methods.add(`get ${key}`);
			}
		}
		proto = Object.getPrototypeOf(proto);
	}
	return [...methods];
};

const describeValue = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
	switch (typeof value) {
		case 'string': {
			return truncate(value, MAX_STRING);
		}
		case 'number': {
			return Number.isFinite(value) ? value : String(value);
		}
		case 'boolean': {
			return value;
		}
		case 'bigint': {
			return `${value}n`;
		}
		case 'symbol': {
			return value.toString();
		}
		case 'undefined': {
			return '[undefined]';
		}
		case 'function': {
			return functionPreview(value);
		}
	}

	if (value === null) {
		return null;
	}

	const obj: any = value;
	if (seen.has(obj)) {
		return '[Circular]';
	}

	try {
		if (typeof Node !== 'undefined' && obj instanceof Node) {
			return nodePreview(obj);
		}
		if (obj instanceof Error) {
			return `[${obj.name}: ${obj.message}]`;
		}
		if (obj instanceof RegExp) {
			return String(obj);
		}
		if (obj instanceof Date) {
			return `[Date ${obj.toISOString()}]`;
		}
		if (obj instanceof Promise) {
			return '[Promise]';
		}
		if (REACT_ELEMENT_TYPES.has(obj.$$typeof)) {
			if (depth <= 0) {
				return `<${componentName(obj.type)} />`;
			}
			seen.add(obj);
			return {
				$element: componentName(obj.type),
				key: obj.key,
				props: describeValue(obj.props, depth - 1, seen),
			};
		}
	} catch {}

	const isArray = Array.isArray(obj);

	if (depth <= 0) {
		if (isArray) {
			return `[Array(${obj.length})]`;
		}
		if (obj instanceof Map || obj instanceof Set) {
			return `[${constructorName(obj)}(${obj.size})]`;
		}

		let keyCount = '?';
		try {
			keyCount = String(Object.keys(obj).length);
		} catch {}
		return `[${constructorName(obj)} with ${keyCount} keys]`;
	}

	seen.add(obj);

	if (isArray || ArrayBuffer.isView(obj)) {
		// DataView is the one array buffer view without a length
		const length: number = Reflect.get(obj, 'length') ?? 0;
		const out = Array.from({ length: Math.min(length, MAX_ARRAY_ITEMS) }, (_, i) =>
			describeValue(safeGet(obj, i), depth - 1, seen),
		);
		if (length > MAX_ARRAY_ITEMS) {
			out.push(`… ${length - MAX_ARRAY_ITEMS} more items`);
		}
		return out;
	}

	if (obj instanceof Map) {
		const entries = obj
			.entries()
			.take(MAX_ARRAY_ITEMS)
			.map(([k, v]) => [describeValue(k, depth - 1, seen), describeValue(v, depth - 1, seen)])
			.toArray();
		return { $type: `Map(${obj.size})`, entries };
	}

	if (obj instanceof Set) {
		const values = obj
			.values()
			.take(MAX_ARRAY_ITEMS)
			.map((v) => describeValue(v, depth - 1, seen))
			.toArray();
		return { $type: `Set(${obj.size})`, values };
	}

	const out: Record<string, unknown> = {};
	const ctor = constructorName(obj);
	if (ctor !== 'Object') {
		out.$type = ctor;
	}

	let keys: string[];
	try {
		keys = Object.keys(obj);
	} catch (e) {
		return `[${ctor}: keys threw ${errorMessage(e)}]`;
	}

	for (const key of keys.slice(0, MAX_KEYS)) {
		out[key] = describeValue(safeGet(obj, key), depth - 1, seen);
	}
	if (keys.length > MAX_KEYS) {
		out['…'] = `${keys.length - MAX_KEYS} more keys`;
	}

	if (ctor !== 'Object' && ctor !== 'Object(null)') {
		const methods = prototypeMethods(obj);
		if (methods.length) {
			out.$methods = methods.slice(0, MAX_KEYS);
		}
	}

	return out;
};

/**
 * previews a value as JSON-safe data, expanding objects up to a depth and capping sizes.
 *
 * @param value value to preview
 * @param depth how many levels of objects to expand
 * @returns JSON-safe data with strings for truncated objects, cycles and non-JSON values
 */
export const describe = (value: unknown, depth: number): unknown => {
	return describeValue(value, depth, new WeakSet());
};

/**
 * serializes a preview for a tool result.
 *
 * @param value preview from {@link describe}, or other JSON-safe data
 * @returns indented JSON, capped in size
 */
export const stringify = (value: unknown): string => {
	return truncate(JSON.stringify(value, null, 2) ?? 'undefined', MAX_OUTPUT);
};
