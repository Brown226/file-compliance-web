/**
 * 系统公告 Composable（单例模式，全局共享状态）
 * 管理公告的获取、标记已读、弹窗展示等逻辑
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { SystemAnnouncement } from '@/types/models'
import {
  getUnreadAnnouncementsApi,
  markAnnouncementReadApi,
  markAllAnnouncementsReadApi,
} from '@/api/announcement'

const SESSION_DISMISS_KEY = 'announcement_dismissed_session'
const SESSION_READ_IDS_KEY = 'announcement_read_ids_session'

// 模块级单例状态 - 所有使用此 composable 的组件共享
const unreadCount = ref(0)
const showAnnouncementPopup = ref(false)
const unreadAnnouncements = ref<SystemAnnouncement[]>([])
const urgentAnnouncements = ref<SystemAnnouncement[]>([])

function getSessionDismissed(): boolean {
  return sessionStorage.getItem(SESSION_DISMISS_KEY) === 'true'
}

function setSessionDismissed(value: boolean): void {
  if (value) {
    sessionStorage.setItem(SESSION_DISMISS_KEY, 'true')
  } else {
    sessionStorage.removeItem(SESSION_DISMISS_KEY)
  }
}

function getSessionReadIds(): Set<string> {
  const raw = sessionStorage.getItem(SESSION_READ_IDS_KEY)
  if (!raw) return new Set()
  try {
    return new Set(JSON.parse(raw))
  } catch {
    return new Set()
  }
}

function addSessionReadId(id: string): void {
  const ids = getSessionReadIds()
  ids.add(id)
  sessionStorage.setItem(SESSION_READ_IDS_KEY, JSON.stringify([...ids]))
}

export function useAnnouncements() {
  /**
   * 检查未读公告并显示弹窗
   * 如果用户在本次会话中已关闭过弹窗，则不再自动显示
   */
  async function checkAndShow() {
    if (getSessionDismissed()) {
      await refreshCount()
      return
    }

    try {
      const res = await getUnreadAnnouncementsApi()
      let announcements = res.data

      // 过滤掉本次会话中已阅读过的公告
      const sessionReadIds = getSessionReadIds()
      if (sessionReadIds.size > 0 && announcements?.length) {
        announcements = announcements.filter((a: SystemAnnouncement) => !sessionReadIds.has(a.id))
      }

      if (announcements && announcements.length > 0) {
        unreadAnnouncements.value = announcements
        unreadCount.value = announcements.length

        urgentAnnouncements.value = announcements.filter(a => a.urgency === 'URGENT')

        showAnnouncementPopup.value = true
      } else {
        unreadCount.value = 0
        unreadAnnouncements.value = []
        urgentAnnouncements.value = []
        showAnnouncementPopup.value = false
      }
    } catch (error: any) {
      console.error('获取未读公告失败:', error)
    }
  }

  async function refreshCount() {
    try {
      const res = await getUnreadAnnouncementsApi()
      const announcements = res.data
      unreadCount.value = announcements?.length || 0
    } catch (error: any) {
      console.error('刷新未读公告数量失败:', error)
    }
  }

  async function markRead(id: string, confirmed?: boolean) {
    try {
      await markAnnouncementReadApi(id, { confirmed })

      addSessionReadId(id)

      unreadAnnouncements.value = unreadAnnouncements.value.filter(a => a.id !== id)
      urgentAnnouncements.value = urgentAnnouncements.value.filter(a => a.id !== id)
      unreadCount.value = unreadAnnouncements.value.length

      if (unreadCount.value === 0) {
        showAnnouncementPopup.value = false
      }
    } catch (error: any) {
      console.error('标记已读失败:', error)
      ElMessage.error('操作失败，请重试')
    }
  }

  async function markAllRead(ids: string[]) {
    if (ids.length === 0) return

    try {
      await markAllAnnouncementsReadApi({ announcementIds: ids })

      ids.forEach(id => addSessionReadId(id))

      unreadAnnouncements.value = []
      urgentAnnouncements.value = []
      unreadCount.value = 0
      showAnnouncementPopup.value = false

      ElMessage.success('已全部标记为已读')
    } catch (error: any) {
      console.error('批量标记已读失败:', error)
      ElMessage.error('操作失败，请重试')
    }
  }

  function closePopup() {
    showAnnouncementPopup.value = false
    setSessionDismissed(true)
  }

  function dismissForSession() {
    closePopup()
  }

  function resetSessionState() {
    setSessionDismissed(false)
    sessionStorage.removeItem(SESSION_READ_IDS_KEY)
  }

  return {
    unreadCount,
    showAnnouncementPopup,
    unreadAnnouncements,
    urgentAnnouncements,
    checkAndShow,
    refreshCount,
    markRead,
    markAllRead,
    closePopup,
    dismissForSession,
    resetSessionState,
  }
}