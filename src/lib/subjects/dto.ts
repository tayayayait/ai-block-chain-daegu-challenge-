export type SubjectPrivateRecord = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  address: string;
  phone: string | null;
}>;

export type MaskedSubjectDto = Readonly<{
  id: string;
  maskedName: string;
  shortAddress: string;
  maskedPhone: string;
}>;

export type FullSubjectPiiDto = Readonly<{
  id: string;
  name: string;
  address: string;
  phone: string | null;
}>;

const HIDDEN_NAME = "이름 비공개";
const HIDDEN_ADDRESS = "주소 비공개";
const HIDDEN_PHONE = "연락처 비공개";

export function maskSubjectName(name: string): string {
  const characters = Array.from(name.trim());
  if (characters.length === 0) {
    return HIDDEN_NAME;
  }
  if (characters.length === 1) {
    return "○";
  }

  return `${characters[0]}${"○".repeat(characters.length - 1)}`;
}

export function maskSubjectPhone(phone: string | null | undefined): string {
  if (!phone) return HIDDEN_PHONE;
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }

  if (digits.length === 10) {
    if (digits.startsWith("02")) {
      return `02-****-${digits.slice(-4)}`;
    }
    return `${digits.slice(0, 3)}-***-${digits.slice(-4)}`;
  }

  if (digits.length === 9 && digits.startsWith("02")) {
    return `02-***-${digits.slice(-4)}`;
  }

  return HIDDEN_PHONE;
}

export function shortenSubjectAddress(address: string): string {
  const parts = address.trim().split(/\s+/);
  const province = parts[0];
  const district = parts[1];

  if (
    !province ||
    !district ||
    !/(?:특별자치도|특별자치시|특별시|광역시|도)$/.test(province) ||
    !/(?:시|군|구)$/.test(district)
  ) {
    return HIDDEN_ADDRESS;
  }

  return `${province} ${district}`;
}

export function toMaskedSubjectDto(subject: SubjectPrivateRecord): MaskedSubjectDto {
  return Object.freeze({
    id: subject.id,
    maskedName: maskSubjectName(subject.name),
    shortAddress: shortenSubjectAddress(subject.address),
    maskedPhone: maskSubjectPhone(subject.phone),
  });
}
