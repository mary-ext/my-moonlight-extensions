// declare each webpack module that other code imports through `@moonlight-mod/wp/<ext>_<module>`

declare module '@moonlight-mod/wp/sampleExtension_greeting' {
	export * from '#/webpackModules/greeting.tsx';
}
