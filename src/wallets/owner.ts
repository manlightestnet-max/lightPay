/** Who owns a wallet: "user:<uid>" for a person (wallets.owner_id). No imports, so any module can use it. */
export const ownerOf = (uid: string) => `user:${uid}`;
/** The uid behind an owner id ("user:<uid>"), or null for wallets that are not a person's. */
export const uidOfOwner = (ownerId: unknown) => (typeof ownerId === 'string' && ownerId.startsWith('user:') ? ownerId.slice(5) : null);
