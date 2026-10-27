import React from 'react';
import { View,type ViewProps } from 'react-native';
import { useQualifiedExposure } from './hooks';
/** Reuses the existing feed item frame. This observes a collection card, never its player. */
export function CollectionExposure({collectionId,...props}:ViewProps&{collectionId?:string|null}){
  const ref=useQualifiedExposure('collection.impression','collection',collectionId??undefined);
  return <View {...props} ref={ref} collapsable={false}/>;
}
