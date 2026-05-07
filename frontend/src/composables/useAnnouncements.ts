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

// 模块级单例状态 - 所有使用此 composable 的组件共享
const unreadCount = ref(0)
const showAnnouncementPopup = ref(false)
const unreadAnnouncements = ref<SystemAnnouncement[]>([])
const urgentAnnouncements = ref<SystemAnnouncement[]>([])

export function useAnnouncements() {
  /**
   * 检查未读公告并显示弹窗
   */
  async function checkAndShow() {
    try {
      const res = await getUnreadAnnouncementsApi()
      const announcements = res.data

      if (announcements && announcements.length > 0) {
        unreadAnnouncements.value = announcements
        unreadCount.value = announcements.length

        // 分离紧急公告和普通公告
        urgentAnnouncements.value = announcements.filter(a => a.urgency === 'URGENT')

        // 如果有未读公告，显示弹窗
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

  /**
   * 刷新未读数量
   */
  async function refreshCount() {
    try {
      const res = await getUnreadAnnouncementsApi()
      const announcements = res.data
      unreadCount.value = announcements?.length || 0
    } catch (error: any) {
      console.error('刷新未读公告数量失败:', error)
    }
  }

  /**
   * 标记单条公告为已读
   */
  async function markRead(id: string, confirmed?: boolean) {
    try {
      await markAnnouncementReadApi(id, { confirmed })

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

  /**
   * 批量标记公告为已读
   */
  async function markAllRead(ids: string[]) {
    if (ids.length === 0) return

    try {
      await markAllAnnouncementsReadApi({ announcementIds: ids })

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

  /**
   * 关闭弹窗
   */
  function closePopup() {
    showAnnouncementPopup.value = false
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
  }
}
