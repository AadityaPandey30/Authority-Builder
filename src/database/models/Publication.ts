import mongoose, { Schema } from 'mongoose';

/**
 * Publication history + daily idempotency guard.
 *
 * `postDate` carries a unique index, so two concurrent cron ticks (or a manual
 * /run racing the scheduler) can never publish twice for the same IST date -
 * the second insert fails with E11000 and is treated as "already published".
 */
export interface PublicationDoc extends mongoose.Document {
  postDate: string;
  status: 'pending' | 'sent' | 'failed';
  pillarId: string;
  topic: string;
  imageUrl: string;
  caption: string;
  phone: string;
  attempts: number;
  lastError?: string;
  whatsappResponse?: unknown;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PublicationSchema = new Schema<PublicationDoc>(
  {
    postDate: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
      index: true,
    },
    pillarId: { type: String, required: true },
    topic: { type: String, required: true },
    imageUrl: { type: String, required: true },
    caption: { type: String, required: true },
    phone: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    lastError: { type: String },
    whatsappResponse: { type: Schema.Types.Mixed },
    sentAt: { type: Date },
  },
  { timestamps: true },
);

export const Publication = mongoose.model<PublicationDoc>('Publication', PublicationSchema);
