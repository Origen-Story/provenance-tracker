// A stand-in for the few parts of a browser the public viewer draws with, so
// a test can run viewer.js and read what it made: which links, which words.
// Not a browser: no layout, no events fired, no styles applied. It keeps the
// tree, attributes, classes and text, which is what the tests look at.

class TinyNode {
	constructor() {
		this.parent = null;
	}
	remove() {
		if (!this.parent) return;
		this.parent.children = this.parent.children.filter((c) => c !== this);
		this.parent = null;
	}
}

class TinyText extends TinyNode {
	constructor(text) {
		super();
		this.data = String(text);
	}
	get textContent() {
		return this.data;
	}
}

class TinyElement extends TinyNode {
	constructor(tag) {
		super();
		this.tagName = String(tag).toUpperCase();
		this.attributes = new Map();
		this.children = [];
		this.dataset = {};
		// Plain properties, and the two methods used for custom properties.
		this.style = {
			setProperty(name, value) {
				this[name] = String(value);
			},
			removeProperty(name) {
				delete this[name];
			},
		};
		this.listeners = [];
		const classes = () => (this.attributes.get("class") || "").split(/\s+/);
		this.classList = {
			add: (...names) => {
				this.className = [...new Set([...classes(), ...names])].join(" ");
			},
			remove: (...names) => {
				this.className = classes()
					.filter((c) => !names.includes(c))
					.join(" ");
			},
			contains: (name) => classes().includes(name),
			toggle: (name, on = !classes().includes(name)) => {
				if (on) this.classList.add(name);
				else this.classList.remove(name);
				return on;
			},
		};
	}
	get className() {
		return this.attributes.get("class") || "";
	}
	set className(v) {
		this.attributes.set("class", String(v).trim());
	}
	get id() {
		return this.attributes.get("id") || "";
	}
	get hidden() {
		return this.attributes.has("hidden");
	}
	set hidden(v) {
		if (v) this.attributes.set("hidden", "");
		else this.attributes.delete("hidden");
	}
	get href() {
		return this.attributes.get("href");
	}
	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}
	getAttribute(name) {
		return this.attributes.has(name) ? this.attributes.get(name) : null;
	}
	hasAttribute(name) {
		return this.attributes.has(name);
	}
	removeAttribute(name) {
		this.attributes.delete(name);
	}
	toggleAttribute(name, on = !this.attributes.has(name)) {
		if (on) this.attributes.set(name, "");
		else this.attributes.delete(name);
		return on;
	}
	addEventListener(type, fn) {
		this.listeners.push({ type, fn });
	}
	removeEventListener() {}
	#adopt(items) {
		return items.map((c) => {
			const node = c instanceof TinyNode ? c : new TinyText(c);
			node.remove();
			node.parent = this;
			return node;
		});
	}
	append(...items) {
		this.children.push(...this.#adopt(items));
	}
	prepend(...items) {
		this.children.unshift(...this.#adopt(items));
	}
	replaceChildren(...items) {
		for (const c of this.children) c.parent = null;
		this.children = [];
		this.append(...items);
	}
	get textContent() {
		return this.children.map((c) => c.textContent).join("");
	}
	set textContent(v) {
		this.replaceChildren(String(v));
	}
	/** Every element below this one, in document order. */
	get all() {
		return this.children.flatMap((c) =>
			c instanceof TinyElement ? [c, ...c.all] : [],
		);
	}
	// Only the selectors the viewer uses: ".class" and "tag".
	querySelectorAll(selector) {
		const match = selector.startsWith(".")
			? (el) => el.classList.contains(selector.slice(1))
			: (el) => el.tagName === selector.toUpperCase();
		return this.all.filter(match);
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] || null;
	}
	getBoundingClientRect() {
		return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
	}
	focus() {}
	scrollIntoView() {}
}

/**
 * Puts the stand-in where the viewer looks for a browser, and gives back a
 * root to mount into and a function that takes it all away again.
 */
export function installTinyDom(pageAddress) {
	const names = [
		"document",
		"window",
		"Node",
		"requestAnimationFrame",
		"cancelAnimationFrame",
		"localStorage",
		"getComputedStyle",
	];
	const before = names.map((n) => [
		n,
		Object.getOwnPropertyDescriptor(globalThis, n),
	]);
	const set = (name, value) =>
		Object.defineProperty(globalThis, name, {
			value,
			configurable: true,
			writable: true,
		});
	const head = new TinyElement("head");
	set("Node", TinyNode);
	set("document", {
		baseURI: pageAddress,
		head,
		createElement: (tag) => new TinyElement(tag),
		createTextNode: (text) => new TinyText(text),
		querySelector: () => null,
	});
	set("window", { innerHeight: 800, addEventListener() {} });
	// Never called back: the tests read the first drawing, not the playback.
	set("requestAnimationFrame", () => 0);
	set("cancelAnimationFrame", () => {});
	set("localStorage", { getItem: () => null, setItem() {} });
	// No layout here: every measured size reads as nothing.
	set("getComputedStyle", () => ({}));
	return {
		root: new TinyElement("main"),
		head,
		restore() {
			for (const [name, descriptor] of before)
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else delete globalThis[name];
		},
	};
}
