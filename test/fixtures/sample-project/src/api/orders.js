import { getUserById } from './users.js';
import { formatCurrency } from '../utils/format.js';
import { multiply } from '../utils/math.js';

export async function createOrder(userId, items) {
	const user = getUserById(userId);
	if (!user) throw new Error('User not found');

	const total = items.reduce((sum, item) => {
		return sum + multiply(item.price, item.qty);
	}, 0);

	return {
		id: Date.now(),
		userId,
		items,
		total: formatCurrency(total),
		status: 'pending'
	};
}

export function calculateDiscount(total, code) {
	const discounts = {
		'SAVE10': 0.1,
		'SAVE20': 0.2,
		'VIP': 0.3
	};

	const rate = discounts[code];
	if (!rate) return 0;
	return multiply(total, rate);
}
