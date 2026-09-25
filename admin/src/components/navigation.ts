import { ChartColumn, CookingPot, Inbox, LayoutDashboard, MessagesSquare, Receipt, Refrigerator, ScrollText, Settings, Users } from 'lucide-react';

export const navigation = [
  { label: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/analytics', label: 'Food outcomes', icon: ChartColumn },
  ] },
  { label: 'Manage', items: [
    { to: '/users', label: 'Users', icon: Users },
    { to: '/food', label: 'Pantry insights', icon: Refrigerator },
    { to: '/recipes', label: 'Recipes', icon: CookingPot },
    { to: '/review', label: 'Needs review', icon: Inbox },
    { to: '/chatbot', label: 'Conversations', icon: MessagesSquare },
  ] },
  { label: 'System', items: [
    { to: '/costs', label: 'API costs', icon: Receipt },
    { to: '/logs', label: 'System logs', icon: ScrollText },
  ] },
];

export const settingsItem = { to: '/settings', label: 'Settings', icon: Settings };
