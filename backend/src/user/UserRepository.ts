import type {
  AccountStatus,
  AccountType,
  CreatorStatus,
  MaterializedUserCounters,
  User,
  UsernameReservation,
} from './domain/types';

export type CreateUserInput = {
  id: string;
  authProvider?: string | null;
  username: string;
  displayName?: string | null;
  profilePhotoUrl?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  socialLinks?: Record<string, string>;
  accountStatus?: AccountStatus;
  creatorStatus?: CreatorStatus;
  accountType?: AccountType;
  country?: string | null;
  language?: string | null;
  timezone?: string | null;
  emailMirrored?: string | null;
};

export type UpdateUserPatch = Partial<
  Omit<User, 'id' | 'createdAt' | 'joinedAt'>
>;

export interface UserRepository {
  insertUser(input: CreateUserInput): Promise<User>;
  getById(id: string): Promise<User | null>;
  getByUsername(username: string): Promise<User | null>;
  updateUser(id: string, patch: UpdateUserPatch): Promise<User>;
  isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean>;
  insertUsernameReservation(input: {
    username: string;
    userId: string;
    redirectToUsername: string;
    reservedUntil: string;
  }): Promise<UsernameReservation>;
  getActiveReservation(username: string): Promise<UsernameReservation | null>;
  /** Mark expired (and optionally username-matching) reservations inactive before reuse. */
  deactivateExpiredReservations(username?: string): Promise<void>;
  applyCounters(id: string, counters: Partial<MaterializedUserCounters>): Promise<void>;
}
