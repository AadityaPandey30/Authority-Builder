import mongoose, { Schema } from 'mongoose';

/**
 * Topic/title history used to steer the model away from repetition. One row per
 * published post; the engine feeds the most recent topics back as an explicit
 * "do not repeat" list.
 */
export interface TopicHistoryDoc extends mongoose.Document {
  postDate: string;
  pillarId: string;
  topic: string;
  createdAt: Date;
  updatedAt: Date;
}

const TopicHistorySchema = new Schema<TopicHistoryDoc>(
  {
    postDate: { type: String, required: true, unique: true, index: true },
    pillarId: { type: String, required: true, index: true },
    topic: { type: String, required: true },
  },
  { timestamps: true },
);

export const TopicHistory = mongoose.model<TopicHistoryDoc>('TopicHistory', TopicHistorySchema);
