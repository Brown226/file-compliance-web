using Normative.Model;
using System;
using System.Collections.Generic;
using System.Threading;

namespace Normative.Core
{
    public class CheckStandardHelper
    {
        private Queue<StandardModel> StandardQue = new Queue<StandardModel>();
        private DocStandard DocStandardInfo;
        private object obj = new object();
        private object objres = new object();
        public List<StandardSimilarity> StandardSimilarityList = new List<StandardSimilarity>();

        public void CheckStandards(DocStandard docstandardinfo, List<StandardModel> StandardModels)
        {
            DocStandardInfo = docstandardinfo;
            foreach (var model in StandardModels)
            {
                StandardQue.Enqueue(model);
            }
            List<Thread> Threads = new List<Thread>();
            for (int i = 0; i < 1; i++)
            {
                Thread th = new Thread(CheckStandard);
                th.IsBackground = true;
                Threads.Add(th);
                th.Start();
            }
            foreach (Thread th in Threads)
            {
                th.Join();
            }
        }

        public void CheckStandard()
        {
            try
            {
                while (StandardQue.Count > 0)
                {
                    try
                    {
                        StandardModel standardModel = null;
                        lock (obj)
                        {
                            if (StandardQue.Count > 0)
                            {
                                standardModel = StandardQue.Dequeue();
                            }
                        }
                        if (standardModel == null)
                        {
                            return;
                        }
                        StandardSimilarity standardSimilarity = new StandardSimilarity();
                        standardSimilarity.StandardNo = standardModel.StandardNo;
                        bool bl = false;

                        double StandardNoSimilarity = 0;
                        if (DocStandardInfo.StandardIdent.ToUpper() == standardModel.StandardIdent.ToUpper())
                        {
                            string S1 = DocStandardInfo.StandardNo.Substring(DocStandardInfo.StandardIdent.Length);
                            string S2 = standardModel.StandardNo.Substring(standardModel.StandardIdent.Length);
                            StandardNoSimilarity = LevenshteinSimilarity(S1, S2, ref bl);
                        }

                        double StandardNameSimilarity = 0;
                        standardSimilarity.StandardName = standardModel.StandardName;
                        StandardNameSimilarity = LevenshteinSimilarity(DocStandardInfo.StandardName, standardModel.StandardName, ref bl);
                        standardSimilarity.Similarity = Math.Max(StandardNoSimilarity, StandardNameSimilarity);
                        standardSimilarity.StandardNameSimilarity = StandardNameSimilarity;
                        standardSimilarity.StandardNoSimilarity = StandardNoSimilarity;
                        standardSimilarity.isreplase = bl;
                        lock (objres)
                        {
                            StandardSimilarityList.Add(standardSimilarity);
                        }
                    }
                    catch (Exception ex)
                    {

                    }
                }
            }
            catch (Exception ex)
            {

            }
        }

        public static double LevenshteinSimilarity(string s1, string s2, ref bool bl)
        {
            int maxLen = Math.Max(s1.Length, s2.Length);
            if (maxLen == 0)
            {
                return 1.0;
            };

            if (s1.Length == 0 || s2.Length == 0)
            {
                return 0;
            }

            if (s1.Contains(" ") || s1.Contains("（") || s1.Contains("(") || s1.Contains("）") || s1.Contains(")")
                || s2.Contains(" ") || s2.Contains("（") || s2.Contains("(") || s2.Contains("）") || s2.Contains(")"))
            {
                s1 = s1.Replace(" ", "").Replace("（", "(").Replace("）", ")");
                s2 = s2.Replace(" ", "").Replace("（", "(").Replace("）", ")");
                bl = true;
            }

            int[,] matrix = new int[s1.Length + 1, s2.Length + 1];

            for (int i = 0; i <= s1.Length; i++)
            {
                matrix[i, 0] = i;
            }
            for (int j = 0; j <= s2.Length; j++)
            {
                matrix[0, j] = j;
            }

            for (int i = 1; i <= s1.Length; i++)
            {
                for (int j = 1; j <= s2.Length; j++)
                {
                    int cost = (s1[i - 1] == s2[j - 1]) ? 0 : 1;
                    matrix[i, j] = Math.Min(
                        matrix[i - 1, j] + 1,      // 删除
                        Math.Min(
                            matrix[i, j - 1] + 1,  // 插入
                            matrix[i - 1, j - 1] + cost)); // 替换
                }
            }
            return 1.0 - (double)matrix[s1.Length, s2.Length] / maxLen;
        }

    }
}
