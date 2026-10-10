import { Share } from 'react-native';
import { worker, WorkerError } from '../lib/worker';

// Sending goes out through the contractor's own phone (the share sheet: Messages, email, …), like
// the Text button. The worker marks the quote or invoice as sent and hands back the customer's link.

export type SendResult = { ok: true } | { ok: false; message: string; url?: string };

export async function sendDocument(input: {
  kind: 'quote' | 'invoice';
  id: string;
  company: string;
  customerName: string | null;
  jobTitle: string;
  invoiceNumber?: number;
}): Promise<SendResult> {
  let url: string;
  try {
    url = (input.kind === 'quote' ? await worker.shareQuote(input.id) : await worker.shareInvoice(input.id)).url;
  } catch (e) {
    return { ok: false, message: e instanceof WorkerError ? e.message : 'Something went wrong making the link.' };
  }
  const first = input.customerName?.trim().split(/\s+/)[0];
  const what =
    input.kind === 'quote' ? `your quote for ${input.jobTitle.toLowerCase()}` : `invoice #${input.invoiceNumber} for ${input.jobTitle.toLowerCase()}`;
  const message = `${first ? `Hi ${first}, ` : 'Hi, '}here's ${what} from ${input.company}. You can ${
    input.kind === 'quote' ? 'look it over and approve it' : 'see the details'
  } here: ${url}`;
  try {
    await Share.share({ message });
    return { ok: true };
  } catch {
    // No share sheet (e.g. a desktop browser): show the link to copy instead.
    return { ok: false, message: 'Copy this link and send it to your customer:', url };
  }
}
