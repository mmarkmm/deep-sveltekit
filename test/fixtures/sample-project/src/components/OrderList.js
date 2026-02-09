// circular dep: OrderList -> UserCard -> OrderList
import { UserCard } from './UserCard.js';
import { createOrder } from '../api/orders.js';

export class OrderList {
	constructor(orders) {
		this.orders = orders;
	}

	render() {
		return this.orders.map(order => {
			const card = new UserCard(order.userId);
			return `<div>${card.render()} - ${order.total}</div>`;
		}).join('');
	}

	async addOrder(userId, items) {
		const order = await createOrder(userId, items);
		this.orders.push(order);
		return order;
	}
}
