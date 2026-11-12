function getInitials(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function createTicketCode(
  userName: string,
  organizationCode: string | null | undefined,
  organizationName: string,
  date: Date,
) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `TK${getInitials(userName)}-${day}${month}${year}-${organizationCode || getInitials(organizationName)}`;
}
