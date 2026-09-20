import {GarageSessionProvider} from '../../components/garage/garage-session';
export default function OwnerLayout({children}: {children: React.ReactNode}) {
  return <GarageSessionProvider>{children}</GarageSessionProvider>;
}
