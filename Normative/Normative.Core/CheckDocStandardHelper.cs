using Normative.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using static System.Windows.Forms.VisualStyles.VisualStyleElement.ToolTip;

namespace Normative.Core
{
    public class CheckDocStandardHelper
    {
        private Queue<DocStandard> DocStandardQue = new Queue<DocStandard>();
        private List<StandardModel> CheckStandardInfos = new List<StandardModel>();
        private DocTypeEnums doctype;
        private object obj = new object();
        public void CheckDocStandard(List<DocStandard> DocStandards, List<StandardModel> _CheckStandardInfos, DocTypeEnums _doctype)
        {
            CheckStandardInfos = _CheckStandardInfos;
            doctype = _doctype;
            foreach (var model in DocStandards)
            {
                DocStandardQue.Enqueue(model);
            }
            List<Thread> Threads = new List<Thread>();
            for (int i = 0; i < 1; i++)
            {
                Thread th = new Thread(CheckDocStandard);
                th.IsBackground = true;
                Threads.Add(th);
                th.Start();
            }
            foreach (Thread th in Threads)
            {
                th.Join();
            }
        }

        private void CheckDocStandard()
        {
            try
            {
                while (DocStandardQue.Count > 0)
                {
                    DocStandard docstandardinfo = null;
                    lock (obj)
                    {
                        docstandardinfo = DocStandardQue.Dequeue();
                    }
                    if (docstandardinfo == null)
                    {
                        return;
                    }
                    try
                    {
                        docstandardinfo.error = new List<string>();
                        StandardSimilarity standardSimilarity = GetStandardSimilarity(docstandardinfo);
                        if (standardSimilarity == null)
                        {
                            docstandardinfo.error.Add("不存在该标准规范");
                            continue;
                        }

                        docstandardinfo.CorrectStandardNo = standardSimilarity.StandardNo;
                        CheckChar(docstandardinfo.StandardNo, docstandardinfo.CorrectStandardNo, docstandardinfo.NoResults, docstandardinfo.CorrectNoResults);
                        if (docstandardinfo.NoResults.Count > 0 || docstandardinfo.CorrectNoResults.Count > 0)
                        {
                            docstandardinfo.error.Add("编号错误");
                        }
                        if (doctype != DocTypeEnums.excel || !string.IsNullOrEmpty(docstandardinfo.StandardName))
                        {
                            docstandardinfo.CorrectStandardName = standardSimilarity.StandardName;
                            CheckChar(docstandardinfo.StandardName, docstandardinfo.CorrectStandardName, docstandardinfo.NameResults, docstandardinfo.CorrectNameResults);
                            if (docstandardinfo.NameResults.Count > 0 || docstandardinfo.CorrectNameResults.Count > 0)
                            {
                                docstandardinfo.error.Add("名称错误");
                            }
                        }
                        if (docstandardinfo.error.Count == 0)
                        {
                            docstandardinfo.error.Add("无错误");
                        }
                    }
                    catch (Exception e)
                    {
                        docstandardinfo.error.Add("检测出现异常");
                    }
                }
            }
            catch (Exception ex)
            {
            }
        }


        private StandardSimilarity GetStandardSimilarity(DocStandard docstandardinfo)
        {
            StandardSimilarity standardSimilarity = null;
            if (!string.IsNullOrEmpty(docstandardinfo.StandardName))
            {
                var qnamesame = CheckStandardInfos.FirstOrDefault(t => t.StandardName == docstandardinfo.StandardName);
                if (qnamesame != null)
                {
                    standardSimilarity = new StandardSimilarity();
                    standardSimilarity.StandardNo = qnamesame.StandardNo;
                    standardSimilarity.StandardName = qnamesame.StandardName;
                    return standardSimilarity;
                }
            }

            var qnosame = CheckStandardInfos.FirstOrDefault(t => t.StandardNo == docstandardinfo.StandardNo);
            if (qnosame != null)
            {
                standardSimilarity = new StandardSimilarity();
                standardSimilarity.StandardNo = qnosame.StandardNo;
                standardSimilarity.StandardName = qnosame.StandardName;
                return standardSimilarity;
            }

            if (!string.IsNullOrEmpty(docstandardinfo.StandardName))
            {
                var qnamesame = CheckStandardInfos.FirstOrDefault(t => t.StandardName.Replace(" ", "") == docstandardinfo.StandardName.Replace(" ", ""));
                if (qnamesame != null)
                {
                    standardSimilarity = new StandardSimilarity();
                    standardSimilarity.StandardNo = qnamesame.StandardNo;
                    standardSimilarity.StandardName = qnamesame.StandardName;
                    return standardSimilarity;
                }
            }

            qnosame = CheckStandardInfos.FirstOrDefault(t => t.StandardNo.Replace(" ", "") == docstandardinfo.StandardNo.Replace(" ", ""));
            if (qnosame != null)
            {
                standardSimilarity = new StandardSimilarity();
                standardSimilarity.StandardNo = qnosame.StandardNo;
                standardSimilarity.StandardName = qnosame.StandardName;
                return standardSimilarity;
            }

            if (!string.IsNullOrEmpty(docstandardinfo.StandardName))
            {
                var qnamesame = CheckStandardInfos.FirstOrDefault(t => t.StandardName.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").Replace("及", "和").Replace("、", "和") == docstandardinfo.StandardName.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").Replace("及", "和").Replace("、", "和"));
                if (qnamesame != null)
                {
                    standardSimilarity = new StandardSimilarity();
                    standardSimilarity.StandardNo = qnamesame.StandardNo;
                    standardSimilarity.StandardName = qnamesame.StandardName;
                    return standardSimilarity;
                }
                qnamesame = CheckStandardInfos.FirstOrDefault(t => t.StandardName.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").Replace("及", "和").Replace("、", "和").ToUpper() == docstandardinfo.StandardName.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").Replace("及", "和").Replace("、", "和").ToUpper());
                if (qnamesame != null)
                {
                    standardSimilarity = new StandardSimilarity();
                    standardSimilarity.StandardNo = qnamesame.StandardNo;
                    standardSimilarity.StandardName = qnamesame.StandardName;
                    return standardSimilarity;
                }
            }

            qnosame = CheckStandardInfos.FirstOrDefault(t => t.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",") == docstandardinfo.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ","));
            if (qnosame == null)
            {
                qnosame = CheckStandardInfos.FirstOrDefault(t => t.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").ToUpper() == docstandardinfo.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").ToUpper());
            }
            if (qnosame == null)
            {
                qnosame = CheckStandardInfos.FirstOrDefault(t => t.StandardNo.Contains(docstandardinfo.StandardNo));
            }
            if (qnosame == null)
            {
                qnosame = CheckStandardInfos.FirstOrDefault(t => docstandardinfo.StandardNo.Contains(t.StandardNo));
            }
            if (qnosame == null)
            {
                qnosame = CheckStandardInfos.FirstOrDefault(t => t.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").Contains(docstandardinfo.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",")));
            }
            if (qnosame == null)
            {
                qnosame = CheckStandardInfos.FirstOrDefault(t => docstandardinfo.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").Contains(t.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",")));
            }
            if (qnosame == null)
            {
                qnosame = CheckStandardInfos.FirstOrDefault(t => t.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").ToUpper().Contains(docstandardinfo.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").ToUpper()));
            }
            if (qnosame == null)
            {
                qnosame = CheckStandardInfos.FirstOrDefault(t => docstandardinfo.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").ToUpper().Contains(t.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",").ToUpper()));
            }

            if (qnosame != null)
            {
                standardSimilarity = new StandardSimilarity();
                standardSimilarity.StandardNo = qnosame.StandardNo;
                standardSimilarity.StandardName = qnosame.StandardName;
                return standardSimilarity;
            }

            string StandardNum = GetStandardNum(docstandardinfo.StandardNo, docstandardinfo.StandardIdent);
            string startIdent = docstandardinfo.StandardIdent.Split('/')[0].Trim();
            foreach (var sitem in CheckStandardInfos)
            {
                string cStandardNum = GetStandardNum(sitem.StandardNo, sitem.StandardIdent);
                if (cStandardNum != StandardNum)
                {
                    continue;
                }
                if (startIdent != sitem.StandardIdent.Split('/')[0].Trim())
                {
                    continue;
                }
                standardSimilarity = new StandardSimilarity();
                standardSimilarity.StandardNo = sitem.StandardNo;
                standardSimilarity.StandardName = sitem.StandardName;
                return standardSimilarity;
            }

            #region 根据相似度匹配
            //var indentStandardInfos = CheckStandardInfos.FindAll(t => t.StandardIdent.ToUpper() == docstandardinfo.StandardIdent.ToUpper());
            //if (indentStandardInfos == null || indentStandardInfos.Count == 0)
            //{
            //    return null;
            //}

            //CheckStandardHelper checkStandardHelper = new CheckStandardHelper();
            //checkStandardHelper.CheckStandards(docstandardinfo, CheckStandardInfos);
            //var res = checkStandardHelper.StandardSimilarityList;
            //standardSimilarity = res.OrderByDescending(t => t.Similarity).ToList()[0];
            //if (standardSimilarity.Similarity == 0)
            //{
            //    return null;
            //}
            //if (standardSimilarity.Similarity < 1)
            //{
            //    var q = res.FirstOrDefault(t => t.StandardNo.Contains(docstandardinfo.StandardNo));
            //    if (q == null)
            //    {
            //        q = res.FirstOrDefault(t => t.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")").Contains(docstandardinfo.StandardNo.Replace(" ", "").Replace("（", "(").Replace("）", ")")));
            //    }
            //    if (q != null)
            //    {
            //        standardSimilarity = q;
            //    }
            //    else
            //    {
            //        if (doctype != DocTypeEnums.excel && !string.IsNullOrEmpty(docstandardinfo.StandardName))
            //        {
            //            var standardNameSimilarity = res.OrderByDescending(t => t.StandardNameSimilarity).ToList()[0];
            //            if (standardNameSimilarity.StandardNameSimilarity < 0.6)
            //            {
            //                return null;
            //            }
            //            if (standardSimilarity.StandardNameSimilarity < standardNameSimilarity.StandardNameSimilarity)
            //            {
            //                standardSimilarity = standardNameSimilarity;
            //            }
            //        }
            //        else if (standardSimilarity.Similarity < 0.6)
            //        {
            //            return null;
            //        }
            //    }
            //} 
            #endregion

            return standardSimilarity;
        }


        private void CheckChar(string StandardInfo, string CorrectStandardInfo, List<CharResult> Results, List<CharResult> CorrectResults)
        {
            int minnolen = Math.Min(StandardInfo.Length, CorrectStandardInfo.Length);
            int errorlen = 0;
            int firstno = 0;

            for (int i = 0; i < minnolen; i++)
            {
                if (StandardInfo[i] == CorrectStandardInfo[i])
                {
                    if (errorlen > 0)
                    {
                        CharResult charResult = new CharResult();
                        charResult.startindex = firstno;
                        charResult.length = errorlen;
                        Results.Add(charResult);
                        CorrectResults.Add(charResult);
                    }
                    errorlen = 0;
                    continue;
                }
                if (errorlen == 0)
                {
                    firstno = i;
                }
                errorlen++;
            }

            if (errorlen > 0)
            {
                CharResult charResult = new CharResult();
                charResult.startindex = firstno;
                charResult.length = errorlen;
                Results.Add(charResult);
                CorrectResults.Add(charResult);
            }

            if (StandardInfo.Length > minnolen)
            {
                CharResult charResult = new CharResult();
                charResult.startindex = minnolen;
                charResult.length = StandardInfo.Length - minnolen;
                Results.Add(charResult);
            }

            if (CorrectStandardInfo.Length > minnolen)
            {
                CharResult charResult = new CharResult();
                charResult.startindex = minnolen;
                charResult.length = CorrectStandardInfo.Length - minnolen;
                CorrectResults.Add(charResult);
            }
        }

        private string GetStandardNum(string StandardNo, string StandardIdent)
        {
            var StandardNum = StandardNo;
            if (!string.IsNullOrEmpty(StandardIdent))
            {
                int numindex = StandardNum.IndexOf(StandardIdent);
                if (numindex >= 0)
                {
                    StandardNum = StandardNum.Substring(StandardIdent.Length + numindex);
                }
            }
            StandardNum = StandardNum.Replace("（", "(");
            if (StandardNum.Contains("-"))
            {
                int numindex = StandardNum.IndexOf("-");
                StandardNum = StandardNum.Substring(0, numindex);
            }
            else if (StandardNum.Contains("("))
            {
                int numindex = StandardNum.IndexOf("(");
                StandardNum = StandardNum.Substring(0, numindex);
            }
            StandardNum = StandardNum.Trim();
            return StandardNum;
        }

    }
}
