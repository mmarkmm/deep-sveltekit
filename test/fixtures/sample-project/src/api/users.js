import { formatDate } from '../utils/format.js';

const users = [];

export function getUsers() {
	return users.map(u => ({
		...u,
		createdAt: formatDate(u.createdAt)
	}));
}

export function getUserById(id) {
	const user = users.find(u => u.id === id);
	if (!user) return null;
	return { ...user, createdAt: formatDate(user.createdAt) };
}

export function createUser(name, email) {
	const user = {
		id: users.length + 1,
		name,
		email,
		createdAt: new Date()
	};
	users.push(user);
	return user;
}

export async function deleteUser(id) {
	const idx = users.findIndex(u => u.id === id);
	if (idx === -1) throw new Error('User not found');
	return users.splice(idx, 1)[0];
}
