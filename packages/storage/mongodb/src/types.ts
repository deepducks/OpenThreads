/**
 * Internal MongoDB document types.
 * We store all entities with MongoDB's native `_id` field instead of a duplicate
 * string id, so we map the domain `*Id` field to `_id` at the persistence layer.
 */
import type { WithId } from 'mongodb';

/** Strip MongoDB's _id from a document shape */
export type WithoutId<T> = Omit<T, '_id'>;

/** Base fields present on every stored document */
export interface BaseDocument {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
}
