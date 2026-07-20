import { ExtractedContact } from "../types";

const CONTACT_SOURCE_TEXT_MAX_LENGTH = 100_000;
const CONTACT_VALUE_MAX_LENGTH = 256;
const MAX_CONTACTS_PER_POST = 25;

function uniqueContacts(contacts: ExtractedContact[]): ExtractedContact[] {
  const seen = new Set<string>();
  const result: ExtractedContact[] = [];

  for (const contact of contacts) {
    const key = `${contact.type}:${contact.value.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(contact);
  }

  return result;
}

function appendContact(contacts: ExtractedContact[], contact: ExtractedContact): void {
  if (contacts.length >= MAX_CONTACTS_PER_POST) {
    return;
  }

  if (contact.value.length > CONTACT_VALUE_MAX_LENGTH) {
    return;
  }

  contacts.push(contact);
}

export function extractContacts(text: string): ExtractedContact[] {
  if (!text) {
    return [];
  }

  const normalizedText = text.slice(0, CONTACT_SOURCE_TEXT_MAX_LENGTH);
  const contacts: ExtractedContact[] = [];

  for (const match of normalizedText.matchAll(/https?:\/\/t\.me\/([a-zA-Z][\w]{3,31})/gi)) {
    appendContact(contacts, {
      type: "telegram",
      value: `@${match[1]}`
    });
  }

  for (const match of normalizedText.matchAll(/(?:^|[\s(])t\.me\/([a-zA-Z][\w]{3,31})(?:$|[\s),.!?])/gi)) {
    appendContact(contacts, {
      type: "telegram",
      value: `@${match[1]}`
    });
  }

  for (const match of normalizedText.matchAll(/(?:^|[\s(])@([a-zA-Z][\w]{3,31})(?:$|[\s),.!?])/g)) {
    appendContact(contacts, {
      type: "telegram",
      value: `@${match[1]}`
    });
  }

  for (const match of normalizedText.matchAll(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g)) {
    appendContact(contacts, {
      type: "email",
      value: match[0]
    });
  }

  for (const match of normalizedText.matchAll(/https?:\/\/[^\s)]+/gi)) {
    if (/https?:\/\/t\.me\//i.test(match[0])) {
      continue;
    }

    appendContact(contacts, {
      type: "url",
      value: match[0]
    });
  }

  return uniqueContacts(contacts);
}
