import React from 'react';
import {View,type ViewProps} from 'react-native';
import {useQualifiedExposure} from '@/src/analytics/hooks';
import type {FindDetailRow} from '@/src/ui/findDetail';
/** Reuse the existing visible-dwell policy; unbound identities never get invented IDs. */
export function MeasuredFindResult({row,...props}:ViewProps&{row:FindDetailRow}){
  const product=Boolean(row.openProductId),enabled=process.env.EXPO_PUBLIC_FIND_MEASUREMENT_ENABLED==='true';
  const ref=useQualifiedExposure(product?'product.impression':'place.impression',product?'product':'place',enabled?(row.openProductId??row.placeId??undefined):undefined,{surface:'find',...(product?{namespace:'auto' as const}:{})});
  return <View {...props} ref={ref} collapsable={false}/>;
}
