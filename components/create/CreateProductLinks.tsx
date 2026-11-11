import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { typeStyle } from '@/src/theme/typography';
import { createFieldColors } from '@/src/ui/createChrome';
import { CREATE_COPY } from '@/src/ui/createCopy';
import { collectStudioProductLinks, MAX_STUDIO_PRODUCT_LINKS, type StudioProductLinkField } from '@/src/ui/createProductLinks';

type Props = {
  fields: StudioProductLinkField[];
  pending: boolean;
  disabled: boolean;
  onChange(id: number, value: string): void;
  onAdd(): void;
  onRemove(id: number): void;
  onSubmit(): void;
};

/** Controlled fields keep the Studio draft intact when this stage collapses. */
export function CreateProductLinks({ fields, pending, disabled, onChange, onAdd, onRemove, onSubmit }: Props) {
  const tokens = useThemeTokens(), links = collectStudioProductLinks(fields), locked = pending || disabled;
  return <View style={{ gap: tokens.space.xs }}>
    {fields.map((field, index) => {
      const error = links.errors[field.id], colors = createFieldColors(tokens, { invalid: Boolean(error) });
      return <View key={field.id} style={{ gap: tokens.space.xxs }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.xs }}>
          <Text style={typeStyle(tokens, 'caption')}>Product URL {index + 1}</Text>
          {fields.length > 1 ? <ActionButton label={CREATE_COPY.productLinkRemove} accessibilityLabel={`Remove product URL ${index + 1}`} variant="quiet" wrapLabel minTouchHeight={44} disabled={locked} onPress={() => onRemove(field.id)} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: tokens.space.md, gap: tokens.space.xs, minHeight: Math.max(48, tokens.space.xxl), backgroundColor: colors.backgroundColor, borderColor: colors.borderColor, borderRadius: tokens.radius.lg }}>
          <Ionicons name="link-outline" size={18} color={tokens.color.textMuted} />
          <TextInput value={field.value} onChangeText={value => onChange(field.id, value)} accessibilityLabel={`Product URL ${index + 1}`} accessibilityHint={error ?? (links.duplicates.includes(field.id) ? CREATE_COPY.productLinkDuplicate : undefined)}
            placeholder={CREATE_COPY.productSourceLinkPlaceholder} placeholderTextColor={colors.placeholderTextColor} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!locked}
            style={{ flex: 1, minWidth: 0, minHeight: 48, paddingVertical: tokens.space.xs, color: colors.color, fontFamily: tokens.fontFamily.regular, fontSize: tokens.fontSize.body, lineHeight: tokens.lineHeight.body }} />
        </View>
        {error ? <Text accessibilityRole="alert" style={[typeStyle(tokens, 'caption'), { color: tokens.color.danger }]}>{error}</Text> : links.duplicates.includes(field.id) ? <Text style={typeStyle(tokens, 'caption')}>{CREATE_COPY.productLinkDuplicate}</Text> : null}
      </View>;
    })}
    {fields.length < MAX_STUDIO_PRODUCT_LINKS ? <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}><ActionButton label={CREATE_COPY.productLinkAddAnother} leadingIcon="add-outline" variant="quiet" wrapLabel minTouchHeight={44} disabled={locked} onPress={onAdd} /></View> : null}
    <ActionButton label={links.urls.length > 1 ? CREATE_COPY.productSourceLinksAction : CREATE_COPY.productSourceLinkAction} variant="outlinePrimary" wrapLabel minTouchHeight={48} pending={pending} disabled={locked || !links.valid} onPress={onSubmit} />
  </View>;
}
