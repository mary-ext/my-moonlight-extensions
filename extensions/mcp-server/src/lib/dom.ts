import { componentName } from './describe.ts';
import { truncate } from './text.ts';

const getFiber = (el: Element): any => {
	for (const key in el) {
		if (key.startsWith('__reactFiber$')) {
			return Reflect.get(el, key);
		}
	}
	return undefined;
};

/**
 * names the component a fiber renders.
 *
 * @param fiber React fiber
 * @returns the component name, or null for host elements, providers, fragments etc.
 */
export const fiberName = ({ type }: any): string | null => {
	if (typeof type === 'function' || type?.displayName || type?.type || type?.render) {
		return componentName(type);
	}
	return null;
};

/**
 * walks up the React tree from an element.
 *
 * @param el DOM element
 * @param limit maximum number of components to collect
 * @returns fibers of the enclosing components, innermost first
 */
export const componentChain = (el: Element, limit: number): any[] => {
	const chain: any[] = [];
	for (let fiber = getFiber(el); fiber && chain.length < limit; fiber = fiber.return) {
		if (fiberName(fiber)) {
			chain.push(fiber);
		}
	}
	return chain;
};

/**
 * finds elements by selector and text.
 *
 * @param selector CSS selector
 * @param text text the elements must contain
 * @returns matching elements; with `text`, only the deepest ones
 */
export const queryElements = (selector: string, text: string | undefined): Element[] => {
	const elements = [...document.querySelectorAll(selector)];
	if (!text) {
		return elements;
	}

	// every ancestor of a match contains the text too, so keep only the deepest matches
	const matched = elements.filter((el) => el.textContent?.includes(text));
	const hasMatchedDescendant = new Set<Element>();
	for (const el of matched) {
		for (
			let parent = el.parentElement;
			parent && !hasMatchedDescendant.has(parent);
			parent = parent.parentElement
		) {
			hasMatchedDescendant.add(parent);
		}
	}
	return matched.filter((el) => !hasMatchedDescendant.has(el));
};

/**
 * summarizes an element for display.
 *
 * @param el DOM element
 * @returns tag, identifying attributes, text and position
 */
export const elementSummary = (el: Element) => {
	const rect = el.getBoundingClientRect();
	return {
		tag: el.tagName.toLowerCase(),
		id: el.id || undefined,
		classes: el.classList.length ? [...el.classList].join(' ') : undefined,
		ariaLabel: el.getAttribute('aria-label') ?? undefined,
		role: el.getAttribute('role') ?? undefined,
		text: truncate((el.textContent ?? '').trim(), 200) || undefined,
		rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
		visible: rect.width > 0 && rect.height > 0,
	};
};
