import React from 'react';

import { TopBar } from '@/components/chrome/TopBar';

interface SharedHeaderProps {
  title?: string;
  showBackButton?: boolean;
  showBagButton?: boolean;
}

/** @deprecated Use `TopBar`. Thin adapter so leftover imports stay on the canonical chrome. */
export default function SharedHeader({
  title = 'MYSTASH',
  showBackButton = false,
  showBagButton = true,
}: SharedHeaderProps) {
  return <TopBar mode="page" title={title} showBack={showBackButton} showBag={showBagButton} />;
}
