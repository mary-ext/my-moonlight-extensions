/// <reference types="@moonlight-mod/types" />

declare module '@moonlight-mod/wp/discord/uikit/Spinner' {
	const Spinner: import('react').ComponentType<{
		style?: import('react').CSSProperties;
		type?: 'spinningCircle' | 'spinningCircleSimple';
	}>;

	export default Spinner;
}
