'use client';

import {
  ApiOutlined,
  BranchesOutlined,
  MessageOutlined,
  SettingOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { ConfigProvider, Layout, Menu, Typography, theme } from 'antd';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const { Sider, Content } = Layout;
const { Text } = Typography;

const NAV_ITEMS = [
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: <Link href="/dashboard">Overview</Link>,
    exact: true,
  },
  {
    key: '/dashboard/channels',
    icon: <ApiOutlined />,
    label: <Link href="/dashboard/channels">Channels</Link>,
  },
  {
    key: '/dashboard/routes',
    icon: <BranchesOutlined />,
    label: <Link href="/dashboard/routes">Routes</Link>,
  },
  {
    key: '/dashboard/threads',
    icon: <MessageOutlined />,
    label: <Link href="/dashboard/threads">Threads</Link>,
  },
  {
    key: '/dashboard/settings',
    icon: <SettingOutlined />,
    label: <Link href="/dashboard/settings">Settings</Link>,
  },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const selectedKey =
    NAV_ITEMS.find((item) =>
      item.exact ? pathname === item.key : pathname.startsWith(item.key) && item.key !== '/dashboard',
    )?.key ??
    (pathname === '/dashboard' ? '/dashboard' : '');

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff' },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Sider
          width={220}
          style={{
            background: '#001529',
            position: 'fixed',
            height: '100vh',
            left: 0,
            top: 0,
            overflow: 'auto',
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              marginBottom: 8,
            }}
          >
            <Text strong style={{ color: '#fff', fontSize: 16 }}>
              OpenThreads
            </Text>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ borderRight: 0 }}
            items={NAV_ITEMS.map(({ key, icon, label }) => ({ key, icon, label }))}
          />
        </Sider>
        <Layout style={{ marginLeft: 220 }}>
          <Content
            style={{
              padding: '24px',
              minHeight: '100vh',
              background: '#f5f5f5',
            }}
          >
            {children}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
