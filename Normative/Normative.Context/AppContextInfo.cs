using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Context
{
    public class AppContextInfo
    {
        private AppContextInfo()
        {
        }

        private static AppContextInfo instance;

        public static AppContextInfo Instance
        {
            get
            {
                if (instance == null)
                {
                    instance = new AppContextInfo();
                }

                return instance;
            }
        }

        private string currentUser;

        public string CurrentUser
        {
            get
            {
                return this.currentUser;
            }
            set
            {
                this.currentUser = value;
            }
        }

        private string rootdirectory;
        public string RootDirectory
        {
            get
            {
                if (string.IsNullOrEmpty(rootdirectory))
                {
                    rootdirectory = @"\\10.102.2.77\Evars\E3D\PDMSTOOLS\Normative";//Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                }
                return rootdirectory;
            }
        }

        private string logdir;
        public string LogDir
        {
            get
            {
                if (string.IsNullOrEmpty(logdir))
                {
                    logdir = Path.Combine(RootDirectory, "Log", DateTime.Now.ToString("yyyyMMdd"));
                }
                return logdir;
            }
        }
    }
}
