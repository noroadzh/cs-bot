import type { ThemeConfig } from 'antd';

export const consoleTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1f6b5a',
    colorInfo: '#1f6b5a',
    colorLink: '#1a5c4e',
    borderRadius: 8,
    fontFamily:
      '"Avenir Next", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    colorBgLayout: '#e8ece9',
    colorText: '#1c2421',
    colorTextSecondary: '#5c6b66',
    controlHeight: 36,
  },
  components: {
    Layout: {
      siderBg: '#14221e',
      headerBg: '#f7f8f6',
      bodyBg: '#e8ece9',
    },
    Menu: {
      darkItemBg: '#14221e',
      darkSubMenuItemBg: '#14221e',
      darkItemSelectedBg: '#1f6b5a',
      darkItemHoverBg: '#1d332c',
      darkItemColor: '#c9d5d0',
      darkItemSelectedColor: '#f4faf7',
      itemBorderRadius: 8,
      itemMarginInline: 10,
    },
    Card: {
      headerBg: 'transparent',
    },
    Table: {
      headerBg: '#f4f7f5',
      headerColor: '#3d4a46',
      rowHoverBg: '#f3f8f6',
    },
    Button: {
      primaryShadow: 'none',
    },
  },
};
