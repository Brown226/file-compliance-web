using Normative.Context;
using Normative.Core;
using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace Normative
{
    public partial class NormativeMain : Form
    {
        public NormativeMain()
        {
            InitializeComponent();
            InitializeMenu();
            btnCheck.BackColor = Color.LightGray;
            btnStandard.BackColor = Color.LightGray;
            btnNotes.BackColor = Color.SkyBlue;
            LoadContent(frm_notes);
            this.BindWaterMark();
            this.SetVersion();
            frm_standard.BindWaterMark();
            frm_check.BindWaterMark();
        }

        private void InitializeMenu()
        {
            // 菜单按钮示例
            btnCheck = new Button
            {
                Text = "规范自检",
                Location = new System.Drawing.Point(0, 50),
                Size = new System.Drawing.Size(140, 40),
                FlatStyle = FlatStyle.Flat
            };
            btnStandard = new Button
            {
                Text = "规范标准",
                Location = new System.Drawing.Point(0, 90),
                Size = new System.Drawing.Size(140, 40),
                FlatStyle = FlatStyle.Flat
            };

            btnNotes = new Button
            {
                Text = "注意事项",
                Location = new System.Drawing.Point(0, 130),
                Size = new System.Drawing.Size(140, 40),
                FlatStyle = FlatStyle.Flat
            };

            btnCheck.FlatAppearance.BorderSize = 0;
            btnStandard.FlatAppearance.BorderSize = 0;
            btnNotes.FlatAppearance.BorderSize = 0;

            MethodInfo methodInfo = btnNotes.GetType().GetMethod("SetStyle", BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.InvokeMethod);
            methodInfo.Invoke(btnNotes, BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.InvokeMethod, null, new object[] { ControlStyles.Selectable, false }, Application.CurrentCulture);
            methodInfo.Invoke(btnCheck, BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.InvokeMethod, null, new object[] { ControlStyles.Selectable, false }, Application.CurrentCulture);
            methodInfo.Invoke(btnStandard, BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.InvokeMethod, null, new object[] { ControlStyles.Selectable, false }, Application.CurrentCulture);

            btnCheck.Click += (s, e) =>
            {
                if (btnCheck.BackColor == Color.SkyBlue)
                {
                    return;
                }
                btnCheck.BackColor = Color.SkyBlue;
                btnStandard.BackColor = Color.LightGray;
                btnNotes.BackColor = Color.LightGray;
                LoadContent(frm_check);
            };
            btnStandard.Click += (s, e) =>
            {
                if (btnStandard.BackColor == Color.SkyBlue)
                {
                    return;
                }
                btnStandard.BackColor = Color.SkyBlue;
                btnCheck.BackColor = Color.LightGray;
                btnNotes.BackColor = Color.LightGray;
                LoadContent(frm_standard);
            };

            btnNotes.Click += (s, e) =>
            {
                if (btnNotes.BackColor == Color.SkyBlue)
                {
                    return;
                }
                btnNotes.BackColor = Color.SkyBlue;
                btnCheck.BackColor = Color.LightGray;
                btnStandard.BackColor = Color.LightGray;
                LoadContent(frm_notes);
            };

            panelMenu.Controls.Add(btnCheck);
            panelMenu.Controls.Add(btnStandard);
            panelMenu.Controls.Add(btnNotes);

            // 添加到主窗体
            this.Controls.Add(panelMenu);
            this.Controls.Add(panelContent);
        }

        private void LoadContent(UserControl userControl)
        {
            this.panelContent.Controls.Clear();
            userControl.Dock = DockStyle.Fill;
            this.panelContent.Controls.Add(userControl);
        }

        private Button btnCheck;
        private Button btnStandard;
        private Button btnNotes;
        private NormativeCheck frm_check = new NormativeCheck();
        private NormativeStandard frm_standard = new NormativeStandard();
        private SoftNotes frm_notes = new SoftNotes();

        private void NormativeMain_Load(object sender, EventArgs e)
        {
            this.lab_User.Text = $"您好，{AppContextInfo.Instance.CurrentUser}";
            //if (!bgw_initsoft.IsBusy)
            //{
            //    bgw_initsoft.RunWorkerAsync();
            //}
        }

        private void bgw_initsoft_DoWork(object sender, System.ComponentModel.DoWorkEventArgs e)
        {
            try
            {
                var logdir = Path.Combine(AppContextInfo.Instance.RootDirectory, "Log");
                if (!Directory.Exists(logdir))
                {
                    return;
                }
                DirectoryInfo logdirinfo = new DirectoryInfo(logdir);
                DirectoryInfo[] logdirinfos = logdirinfo.GetDirectories();
                if (logdirinfos.Length == 0)
                {
                    return;
                }
                DateTime nowday = DateTime.MinValue;
                DateTime.TryParseExact(DateTime.Now.ToString("yyyyMMdd"), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out nowday);
                if (nowday == DateTime.MinValue)
                {
                    return;
                }
                foreach (var d in logdirinfos)
                {
                    if (!d.Exists)
                    {
                        continue;
                    }
                    string dirname = d.Name;
                    DateTime dt = DateTime.MinValue;
                    if (!DateTime.TryParseExact(dirname, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out dt))
                    {
                        continue;
                    }
                    if (dt < nowday)
                    {
                        Directory.Delete(d.FullName, true);
                    }
                }
            }
            catch (Exception ex)
            {

            }
        }
    }
}
