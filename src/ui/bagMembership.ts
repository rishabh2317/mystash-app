/** Whether a catalog product is already a Bag line. Cart remains the API name. */
export function catalogProductInBag(
  items: readonly { catalogProductId: string }[],
  catalogProductId: string | null | undefined,
): boolean {
  const id = catalogProductId?.trim();
  if (!id) return false;
  return items.some((item) => item.catalogProductId === id);
}
