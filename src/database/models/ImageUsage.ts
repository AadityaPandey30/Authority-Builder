import mongoose, { Schema } from 'mongoose';

/**
 * Image usage history. Kept separate from Publication so recently used images
 * stay excluded even if a publication row is later pruned or the image was
 * drawn for a post that failed before reaching WhatsApp.
 */
export interface ImageUsageDoc extends mongoose.Document {
  url: string;
  pillarId: string;
  usedAt: Date;
  postDate: string;
}

const ImageUsageSchema = new Schema<ImageUsageDoc>(
  {
    url: { type: String, required: true, index: true },
    pillarId: { type: String, required: true },
    usedAt: { type: Date, required: true, default: Date.now, index: true },
    postDate: { type: String, required: true },
  },
  { timestamps: true },
);

export const ImageUsage = mongoose.model<ImageUsageDoc>('ImageUsage', ImageUsageSchema);
