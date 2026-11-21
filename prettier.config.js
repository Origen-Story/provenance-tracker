// Prettier's defaults, with one change: tabs instead of spaces.
//
// Why tabs: each developer sets how wide a tab looks in their own editor, so
// someone working with a large font, a screen magnifier or a narrow window
// can choose a small indent, and someone who needs stronger visual structure
// a large one, without the file changing. Spaces fix the width for everyone.
// (YAML forbids tabs; Prettier uses spaces there regardless.)
//
// Formatting is not a review topic: Prettier writes it, CI checks it.
export default {
	useTabs: true,
};
