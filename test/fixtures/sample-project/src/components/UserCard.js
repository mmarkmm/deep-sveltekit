// circular dep: UserCard -> OrderList -> UserCard
import { OrderList } from './OrderList.js';
import { getUserById } from '../api/users.js';

export class UserCard {
	constructor(userId) {
		this.userId = userId;
	}

	render() {
		const user = getUserById(this.userId);
		if (!user) return '<div>Unknown user</div>';
		return `<div class="user-card">${user.name}</div>`;
	}

	renderWithOrders(orders) {
		const list = new OrderList(orders);
		return `${this.render()}${list.render()}`;
	}
}
