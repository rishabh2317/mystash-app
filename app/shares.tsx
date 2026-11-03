/** Preserve the existing /shares deep link as the unified Find history entry. */
import { Redirect, type Href } from 'expo-router';
export default function YourSharesScreen() { return <Redirect href={'/(tabs)/find?filter=all' as Href} />; }
