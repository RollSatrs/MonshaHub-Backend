export const ROLES = ['OWNER', 'CASHIER'] as const;
export type Role = (typeof ROLES)[number];
