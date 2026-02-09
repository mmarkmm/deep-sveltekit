import { clamp } from './math.js';

export function formatCurrency(amount, currency = 'USD') {
	const clamped = clamp(amount, 0, 999999);
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency
	}).format(clamped);
}

export function formatDate(date) {
	if (!(date instanceof Date)) {
		date = new Date(date);
	}
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}
