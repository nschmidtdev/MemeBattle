import { use } from 'react'
import LobbyRoom from './LobbyRoom'

export default function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  return <LobbyRoom code={code} />
}
