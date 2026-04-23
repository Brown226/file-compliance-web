using Normative.Context;
using System;
using System.IO;
using System.Net;

namespace Normative.Core
{
    public class FileHelper
    {
        private string ftpAddress = "";

        private string UserName = "";

        private string Password = "";

        public FileHelper()
        {
            ftpAddress = @"ftp://10.102.2.73/";
            UserName = "PDMSDB";
            Password = "password01!";
        }


        private static FileHelper instance;
        public static FileHelper Instance
        {
            get
            {
                if (instance == null)
                {
                    instance = new FileHelper();
                }

                return instance;
            }
        }

        public bool DownloadFile(string fileName, string filePath)
        {
            return DownloadByFtp(ftpAddress + fileName, UserName, Password, filePath);
        }

        private bool DownloadByFtp(
            string uri,
            string userName,
            string password, string filePath)
        {
            try
            {
                var rq = (FtpWebRequest)FtpWebRequest.Create(new Uri(uri));
                rq.Credentials = new NetworkCredential(userName, password);
                rq.KeepAlive = false;
                rq.Method = WebRequestMethods.Ftp.DownloadFile;
                rq.UseBinary = true;
                using (var rs = (FtpWebResponse)rq.GetResponse())
                {
                    using (var fs = new FileStream(filePath, FileMode.Create))
                    {
                        using (var rsStream = rs.GetResponseStream())
                        {
                            var bf = new byte[2048];
                            var br = 0;
                            int count = 0;
                            while ((br = rsStream.Read(bf, 0, bf.Length)) > 0)
                            {
                                count += br;
                                fs.Write(bf, 0, br);
                            }
                        }
                    }
                }

                return true;
            }
            catch (Exception e)
            {
                GlobalHelper.appendlog(e.ToString());
                return false;
            }
        }
    }
}
