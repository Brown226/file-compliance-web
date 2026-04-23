using Normative.Core;
using Normative.Model;
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
    public partial class SelfPropStandard : Form
    {
        public SelfPropStandard()
        {
            InitializeComponent();
            this.gdv_standard.AutoGenerateColumns = false;
            this.gdv_standard.DataSource = null;
            this.BindWaterMark();
            this.SetVersion();
        }

        List<StandardModel> StandardModels = new List<StandardModel>();
        private void SelfPropStandard_Load(object sender, EventArgs e)
        {
            StandardModels = NormativeDataHelper.Instance.SelfStandardInfos;
            if (StandardModels.Count > 0)
            {
                this.gdv_standard.DataSource = StandardModels;
            }
        }

        private void btn_Import_Click(object sender, EventArgs e)
        {
            try
            {
                if (NormativeDataHelper.Instance.SelfStandardInfos.Count > 0)
                {
                    DialogResult dr = MessageBox.Show($"您确定清空已经导入的标准并重新导入吗？", "消息提示", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                    if (dr != DialogResult.OK)
                    {
                        return;
                    }
                }

                OpenFileDialog of = new OpenFileDialog();
                of.Title = "导入";
                of.Filter = "xlsx文件(*.xlsx)|*.xlsx|xls文件(*.xls)|*.xls";
                if (of.ShowDialog() != DialogResult.OK)
                {
                    return;
                }

                StandardModels = new List<StandardModel>();
                NormativeDataHelper.Instance.SelfStandardInfos = new List<StandardModel>();
                gdv_standard.DataSource = null;
                string filename = of.FileName;
                StandardModels = NormativeHelper.GetStandard(filename);
                if (StandardModels != null && StandardModels.Count > 0)
                {
                    NormativeDataHelper.Instance.SelfStandardInfos = StandardModels;
                    gdv_standard.DataSource = StandardModels;
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {

            }
        }

        private void btn_clear_Click(object sender, EventArgs e)
        {
            try
            {
                NormativeDataHelper.Instance.SelfStandardInfos = new List<StandardModel>();
                StandardModels = new List<StandardModel>();
                this.gdv_standard.DataSource = null;
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {
            }
        }

        #region 列表操作
        private void gdv_model_RowPostPaint(object sender, DataGridViewRowPostPaintEventArgs e)
        {
            try
            {
                var grid = sender as DataGridView;
                var rowidx = (e.RowIndex + 1).ToString();
                var centerformat = new StringFormat()
                {
                    Alignment = StringAlignment.Center,
                    LineAlignment = StringAlignment.Center
                };
                var headerbounds = new Rectangle(e.RowBounds.Left, e.RowBounds.Top, grid.RowHeadersWidth, e.RowBounds.Height);
                e.Graphics.DrawString(rowidx, this.Font, SystemBrushes.ControlText, headerbounds, centerformat);
            }
            catch (Exception)
            {

            }
        }

        #endregion

    }
}
