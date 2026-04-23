using System;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace Normative.Core
{
    public static class CommHelper
    {
        #region 控件操作

        public delegate void refreshgridhandler(DataGridView dgw, int index);
        public static void refreshgrid(DataGridView dgw, int index)
        {
            if (dgw.InvokeRequired)
            {
                dgw.Invoke(new refreshgridhandler(refreshgrid), dgw, index);
            }
            else
            {
                try
                {
                    if (index > 5 && dgw.Rows.Count > 6)
                    {
                        dgw.FirstDisplayedScrollingRowIndex = index - 5;
                    }
                    if (dgw.Columns.Cast<DataGridViewColumn>().Any(column => column.Name == "MessInfo"))
                    {
                        if (dgw.Rows[index].Cells["MessInfo"].Value != null && dgw.Rows[index].Cells["MessInfo"].Value.ToString() == "查看详情")
                        {
                            dgw.Rows[index].Cells["MessInfo"].Style.ForeColor = Color.Blue;
                            dgw.Rows[index].Cells["MessInfo"].Style.Font = new Font("宋体", 9F, System.Drawing.FontStyle.Underline);
                        }
                    }
                    dgw.Refresh();
                    dgw.ClearSelection();
                    dgw.Rows[index].Selected = true;
                }
                catch (Exception ex)
                {

                }
            }
        }

        #endregion

    }
}
