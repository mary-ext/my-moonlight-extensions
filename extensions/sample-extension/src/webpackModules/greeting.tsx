import React from 'react';

/**
 * reads the configured greeting.
 *
 * @returns the configured text, or `hello!` if unset
 */
export const getGreeting = (): string => {
	return moonlight.getConfigOption<string>('sampleExtension', 'greeting') ?? 'hello!';
};

/**
 * renders the greeting configured at mount time.
 *
 * @returns a span containing the greeting
 */
export const Greeting = () => {
	const [greeting] = React.useState(getGreeting);

	return <span>{greeting}</span>;
};
