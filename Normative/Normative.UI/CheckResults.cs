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
using System.Xml.Linq;

namespace Normative
{
    public partial class CheckResults : Form
    {
        private ItemModel docitemmodel;
        List<DocStandard> resultmodels = new List<DocStandard>();
        public CheckResults(ItemModel _docitemmodel)
        {
            InitializeComponent();
            this.BindWaterMark();
            this.SetVersion();
            docitemmodel = _docitemmodel;
            resultmodels = new List<DocStandard>();
            gdv_result.AutoGenerateColumns = false;
            gdv_result.DataSource = null;
            initdata();
        }

        private void initdata()
        {
            this.lab_filename.Text = docitemmodel.FileName;
            foreach (var item in docitemmodel.DocStandards)
            {
                resultmodels.Add(item);
            }
            if (resultmodels.Count > 0)
            {
                gdv_result.DataSource = resultmodels;
            }
        }

        #region 列表操作
        private void gdv_result_RowPostPaint(object sender, DataGridViewRowPostPaintEventArgs e)
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

        private void CheckResults_Load(object sender, EventArgs e)
        {
            try
            {
                if (resultmodels == null || resultmodels.Count == 0)
                {
                    return;
                }

                for (int i = 0; i < resultmodels.Count; i++)
                {
                    var resitem = resultmodels[i];
                    if (string.IsNullOrEmpty(resitem.errorinfo) || resitem.errorinfo == "无错误")
                    {
                        continue;
                    }
                    if (resitem.errorinfo.Contains("错误"))
                    {
                        gdv_result.Rows[i].Cells["errorinfo"].Style.ForeColor = Color.Red;
                        if (resitem.errorinfo.Contains("编号错误"))
                        {
                            gdv_result.Rows[i].Cells["CorrectStandardNo"].Style.ForeColor = Color.Red;
                        }
                        if (resitem.errorinfo.Contains("名称错误"))
                        {
                            gdv_result.Rows[i].Cells["CorrectStandardName"].Style.ForeColor = Color.Red;
                        }
                    }
                    else
                    {
                        gdv_result.Rows[i].Cells["errorinfo"].Style.ForeColor = Color.Blue;
                    }                 
                }
            }
            catch (Exception ex)
            {

            }
        }
    }
}
