import { pgTable, text, uuid, timestamp, boolean, index, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { petsTable } from "./pets";
import { usersTable } from "./users";

export const postsTable = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    petId: uuid("pet_id")
      .references(() => petsTable.id)
      .notNull(),
    // R2 object key — resolved to a URL at serve time, never stored as a full URL
    mediaKey: text("media_key").notNull(),
    caption: text("caption"),
    isNursery: boolean("is_nursery").notNull().default(false),
    // Focal point for cover-crop rendering (0–1 each axis). null = center (default cover behavior).
    cropFocusX: real("crop_focus_x"),
    cropFocusY: real("crop_focus_y"),
    createdAt:  timestamp("created_at").defaultNow().notNull(),
    archivedAt:    timestamp("archived_at"),
    // Which co-owner created this post — for moderation/audit only, NEVER displayed
    // in any UI.  Null on existing rows (backfilled to primary owner at deploy time).
    postedByUserId: text("posted_by_user_id").references(() => usersTable.id),
    // Set by admins during moderation. Distinct from owner-archive:
    // hidden posts are excluded from all public reads but remain visible to
    // the owner on their pet profile with a "hidden by moderation" note.
    hiddenByAdmin: boolean("hidden_by_admin").notNull().default(false),
    // Auto-frame crop rect (0–1 fractions of original image dimensions).
    // null = not set; rendering falls back to cropFocusX/Y legacy behavior.
    cropMode: text("crop_mode"),       // 'cover' | 'contain' | null
    cropX: real("crop_x"),             // left edge
    cropY: real("crop_y"),             // top edge
    cropW: real("crop_w"),             // width
    cropH: real("crop_h"),             // height
    // Hex color sampled from the photo; fills frame space the photo doesn't
    // cover when the poster zoomed out past the image bounds. null = full cover.
    cropFillColor: text("crop_fill_color"),
    // Tiny (~24px) thumbnail of the photo as a data URI. Static surfaces
    // stretch it under the photo for a blurred-looking fill; null = solid
    // crop_fill_color fallback only.
    cropFillThumb: text("crop_fill_thumb"),
  },
  (table) => [
    index("posts_pet_id_idx").on(table.petId),
  ],
);

export const insertPostSchema = createInsertSchema(postsTable);
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
