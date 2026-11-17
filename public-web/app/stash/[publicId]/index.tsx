import Proof from '@/public-web/screens/Proof';
import Screen from '@/components/public-stash/PublicStashScreen';
export default process.env.EXPO_PUBLIC_PUBLIC_STASH_PROOF==='true'?Proof:Screen;
