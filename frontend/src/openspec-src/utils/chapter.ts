import { chapterTemplateMap, promptParamsByTitle,outlineTemplate } from '../data/mockData';

//获取对应章节的模板内容
export const getChapterTemplate = (title: string) => {
    if(!title) return '' 
    if (title && promptParamsByTitle[title]) {
        const entry: any = promptParamsByTitle[title]
        return typeof entry === 'string' ? entry : (entry?.template || '')
    }
    const found = outlineTemplate.find((it: any) => String(it.title).trim() === title)
    if (found) {
        const fid = Number(found.id)
        if (!Number.isNaN(fid) && chapterTemplateMap[fid]) return chapterTemplateMap[fid]
    }
    return ''
}