import Proof from '@/public-web/screens/Proof';
import Screen from '@/public-web/components/PublicStashEditorial';
export default process.env.EXPO_PUBLIC_PUBLIC_STASH_PROOF==='true'?Proof:Screen;
