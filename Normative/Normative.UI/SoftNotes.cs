using Normative.Core;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Normative
{
    public partial class SoftNotes : UserControl
    {
        public SoftNotes()
        {
            InitializeComponent();            
        }

        private void lab_Explanation_Click(object sender, EventArgs e)
        {
            try
            {
                var SaveDialog = new SaveFileDialog();
                SaveDialog.Title = "输出文件";
                SaveDialog.Filter = "PDF文件(*.pdf)|*.pdf";
                SaveDialog.FilterIndex = 1;
                SaveDialog.RestoreDirectory = true;
                SaveDialog.FileName = "设计文件规范引用自查工具使用说明";
                if (SaveDialog.ShowDialog() != DialogResult.OK)
                {
                    return;
                }
                var savefilename = SaveDialog.FileName;
                bool bl = FileHelper.Instance.DownloadFile("设计文件规范引用自查工具使用说明.pdf", savefilename);

                if (bl)
                {
                    MessageBox.Show("下载完成");
                }
                else
                {
                    MessageBox.Show("下载失败");
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }

        }
    }
}
