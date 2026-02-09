export class Button {
	constructor(label, onClick) {
		this.label = label;
		this.onClick = onClick;
		this.disabled = false;
	}

	render() {
		return `<button ${this.disabled ? 'disabled' : ''}>${this.label}</button>`;
	}

	enable() {
		this.disabled = false;
	}

	disable() {
		this.disabled = true;
	}
}

export function createButton(label, onClick) {
	return new Button(label, onClick);
}
